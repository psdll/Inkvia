"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { NodeToolbar, Position } from "@xyflow/react";
import { ArrowUp, ChevronDown, ChevronUp, Gauge, Scissors, X } from "lucide-react";
import { analyzeAudioUrlCached, formatCanvasAudioTime } from "@/lib/canvas/audio-waveform";
import { trimCanvasAudio, type CanvasAudioClip } from "@/lib/canvas/audio-trim";
import { CANVAS_AUDIO_SPEED_MIN, CANVAS_AUDIO_SPEED_MAX, changeCanvasAudioSpeed } from "@/lib/canvas/audio-speed";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";

type Range = { start: number; end: number; duration: number };
type TrimControls = {
  range: Range | null;
  editing: boolean;
  busy: boolean;
  open: () => void;
  openSpeed: () => void;
  change: (start: number, end: number) => void;
};
const AudioTrimContext = React.createContext<TrimControls | null>(null);
export const useCanvasAudioTrim = () => React.useContext(AudioTrimContext);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function CanvasAudioTrimProvider({ nodeId, src, durationSeconds, onExport, children }: {
  nodeId: string;
  src: string;
  durationSeconds?: number;
  onExport: (clip: CanvasAudioClip, speed?: number) => Promise<void>;
  children: React.ReactNode;
}) {
  const { text, label: uiLabel, error: uiError } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const [range, setRange] = React.useState<Range | null>(null);
  const [speed, setSpeed] = React.useState<number | null>(null);
  const [speedDraft, setSpeedDraft] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const lock = React.useRef(false);
  const open = async () => {
    if (readOnly || lock.current) return;
    lock.current = true;
    setSpeed(null);
    setBusy(true); setError("");
    try {
      const duration = durationSeconds && durationSeconds > 0 ? durationSeconds : (await analyzeAudioUrlCached(src)).durationSeconds;
      if (!(duration > 0)) throw new Error("无法读取音频时长");
      setRange({ start: 0, end: duration / 2, duration });
    } catch (reason) { setError(reason instanceof Error ? reason.message : text("workspaceFollowup.mf511d1c67ad4")); }
    finally { lock.current = false; setBusy(false); }
  };
  const change = (start: number, end: number) => {
    if (lock.current || !range || !Number.isFinite(start) || !Number.isFinite(end)) return;
    const min = Math.min(.01, range.duration);
    setRange({ ...range, start: clamp(start, 0, range.duration - min), end: clamp(end, clamp(start, 0, range.duration - min) + min, range.duration) });
  };
  const generate = async () => {
    if ((!range && speed === null) || readOnly || lock.current) return;
    if (speed !== null && (!Number.isFinite(speed) || speed < CANVAS_AUDIO_SPEED_MIN || speed > CANVAS_AUDIO_SPEED_MAX)) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (speed !== null) await onExport(await changeCanvasAudioSpeed(src, speed), speed);
      else if (range) await onExport(await trimCanvasAudio(src, range.start, range.end));
      setRange(null); setSpeed(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : text("workspaceFollowup.mc8df3f5f9954")); }
    finally { lock.current = false; setBusy(false); }
  };
  const speedValid = speed === null || (Number.isFinite(speed) && speed >= CANVAS_AUDIO_SPEED_MIN && speed <= CANVAS_AUDIO_SPEED_MAX);
  const stepSpeed = (delta: number) => {
    setSpeedDraft(null);
    setSpeed(current => Number(clamp((current !== null && Number.isFinite(current) ? current : 1) + delta, CANVAS_AUDIO_SPEED_MIN, CANVAS_AUDIO_SPEED_MAX).toFixed(2)));
  };
  const mode = speed === null ? "截取" : "变速";
  return <AudioTrimContext.Provider value={{ range, editing: Boolean(range) || speed !== null, busy, open: () => { void open(); }, change,
    openSpeed: () => { if (!readOnly && !lock.current) { setRange(null); setError(""); setSpeedDraft(null); setSpeed(1); } },
  }}>
    {children}
    {(range || speed !== null || error || busy) && <NodeToolbar nodeId={nodeId} isVisible position={Position.Bottom} offset={18} className="nodrag nopan nowheel"
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 shadow-lg">
        <div className="flex items-center gap-3 text-sm text-[var(--app-fg)]">
          <button type="button" aria-label={text("workspaceFollowup.mf247d1702c2c", { v0: mode })} disabled={busy} onClick={() => { setRange(null); setSpeed(null); setError(""); }} className="rounded p-1 disabled:opacity-40"><X className="h-4 w-4" /></button>
          <span>{uiLabel(mode)}</span>
          {speed !== null && <>
            <span className="text-xs text-[var(--app-muted)]">0.1x</span>
            <UiProps ids={{"aria-label":["canvas.me9c712133fae"]}}><input type="range" aria-label="canvas.me9c712133fae" min={CANVAS_AUDIO_SPEED_MIN} max={CANVAS_AUDIO_SPEED_MAX} step="0.01" value={Number.isFinite(speed) ? clamp(speed, CANVAS_AUDIO_SPEED_MIN, CANVAS_AUDIO_SPEED_MAX) : 1} disabled={busy}
              onChange={event => { setSpeedDraft(null); setSpeed(Number(event.target.value)); }} className="w-28 accent-[var(--primary-bg)]" /></UiProps>
            <span className="text-xs text-[var(--app-muted)]">4.0x</span>
            <UiProps ids={{"aria-label":["canvas.m660ac71c8a8e"]}}><div role="group" aria-label="canvas.m660ac71c8a8e" className="flex h-8 items-center rounded-lg pl-2 pr-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" style={{ backgroundColor: "color-mix(in srgb, var(--app-fg) 10%, var(--panel-bg))" }}>
              <UiProps ids={{"aria-label":["canvas.m604c3bacfbd8"]}}><input type="number" aria-label="canvas.m604c3bacfbd8" min={CANVAS_AUDIO_SPEED_MIN} max={CANVAS_AUDIO_SPEED_MAX} step="0.01" value={speedDraft ?? (Number.isFinite(speed) ? speed.toFixed(2) : "")} disabled={busy}
                onFocus={event => { setSpeedDraft(event.target.value); event.target.select(); }} onBlur={() => setSpeedDraft(null)}
                onChange={event => { setSpeedDraft(event.target.value); setSpeed(event.target.value === "" ? NaN : Number(event.target.value)); }}
                className="w-[4ch] appearance-none bg-transparent text-right tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" /></UiProps><span>x</span>
              <div className="ml-1 flex flex-col">
                <UiProps ids={{"aria-label":["canvas.m3115d7e148e2"]}}><button type="button" aria-label="canvas.m3115d7e148e2" disabled={busy || speed >= CANVAS_AUDIO_SPEED_MAX} onClick={() => stepSpeed(.01)} className="flex h-4 w-4 items-center justify-center rounded-t text-[var(--app-muted)] hover:bg-white/10 hover:text-[var(--app-fg)] disabled:opacity-30"><ChevronUp className="h-3 w-3" /></button></UiProps>
                <UiProps ids={{"aria-label":["canvas.m8af31699a492"]}}><button type="button" aria-label="canvas.m8af31699a492" disabled={busy || speed <= CANVAS_AUDIO_SPEED_MIN} onClick={() => stepSpeed(-.01)} className="flex h-4 w-4 items-center justify-center rounded-b text-[var(--app-muted)] hover:bg-white/10 hover:text-[var(--app-fg)] disabled:opacity-30"><ChevronDown className="h-3 w-3" /></button></UiProps>
              </div>
            </div></UiProps>
          </>}
          {range && <div className="flex items-center gap-1 rounded-md bg-[var(--input-bg)] px-2 py-1">
            <UiProps ids={{"aria-label":["canvas.m07d95df525b1"]}}><input aria-label="canvas.m07d95df525b1" type="number" min={0} max={range.end - .01} step="0.01" value={Number(range.start.toFixed(2))} disabled={busy}
              onChange={event => change(Math.min(Number(event.target.value), range.end - .01), range.end)} className="w-16 bg-transparent text-center outline-none" /></UiProps>
            <span>–</span>
            <UiProps ids={{"aria-label":["canvas.m06b387f4d32f"]}}><input aria-label="canvas.m06b387f4d32f" type="number" min={range.start + .01} max={range.duration} step="0.01" value={Number(range.end.toFixed(2))} disabled={busy}
              onChange={event => change(range.start, Number(event.target.value))} className="w-16 bg-transparent text-center outline-none" /></UiProps><span><UiText id="canvas.m9dcdc2b289b9" /></span>
          </div>}
          <UiProps ids={{"aria-label":["canvas.m881f99f2123e","canvas.m98970876e670"]}}><button type="button" aria-label={speed === null ? "canvas.m881f99f2123e" : "canvas.m98970876e670"} disabled={busy || (!range && speed === null) || !speedValid} onClick={() => { void generate(); }} className="rounded-lg bg-[var(--app-fg)] px-3 py-2 text-[var(--panel-bg)] disabled:opacity-50">{busy ? <UiText id="canvas.md3d21191f32e" /> : speed === null ? <UiText id="canvas.m1ad1463fe16f" /> : <ArrowUp className="h-4 w-4" />}</button></UiProps>
        </div>
        {error && <p role="alert" className="max-w-sm text-xs text-red-400">{uiError(error)}</p>}
      </div>
    </NodeToolbar>}
  </AudioTrimContext.Provider>;
}

export function CanvasAudioTrimButton() {
  const trim = useCanvasAudioTrim();
  const readOnly = useCanvasReadOnly();
  if (!trim || readOnly) return null;
  return <UiProps ids={{"aria-label":["canvas.mb32222d6ea20"]}}><button type="button" aria-label="canvas.mb32222d6ea20" disabled={trim.busy} className="canvas-material-toolbar-item nodrag" onClick={trim.open}>
    <Scissors className="h-4 w-4" /><UiText id="canvas.m043a57f12fb2" /></button></UiProps>;
}

export function CanvasAudioSpeedButton() {
  const trim = useCanvasAudioTrim();
  const readOnly = useCanvasReadOnly();
  if (!trim || readOnly) return null;
  return <UiProps ids={{"aria-label":["canvas.m83011cf27300"]}}><button type="button" aria-label="canvas.m83011cf27300" disabled={trim.busy} className="canvas-material-toolbar-item nodrag" onClick={trim.openSpeed}>
    <Gauge className="h-4 w-4" /><UiText id="canvas.m1eede67ef0f6" /></button></UiProps>;
}

export function CanvasAudioTrimSelection() {
  const trim = useCanvasAudioTrim();
  const root = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ pointerId: number; x: number; width: number; range: Range; mode: "start" | "end" | "move" } | null>(null);
  if (!trim?.range) return null;
  const { range, change, busy } = trim;
  const begin = (event: React.PointerEvent<HTMLElement>, mode: "start" | "end" | "move") => {
    event.stopPropagation(); event.preventDefault();
    if (busy || event.button !== 0) return;
    const width = root.current?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, width, range, mode };
    root.current?.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const delta = (event.clientX - current.x) / current.width * current.range.duration;
    const { start, end, duration } = current.range;
    if (current.mode === "start") change(clamp(start + delta, 0, end - .01), end);
    else if (current.mode === "end") change(start, clamp(end + delta, start + .01, duration));
    else {
      const offset = clamp(delta, -start, duration - end);
      change(start + offset, end + offset);
    }
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div ref={root} data-canvas-audio-trim-selection className="nodrag nopan absolute inset-0 touch-none select-none"
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onPointerMove={move} onPointerUp={event => { move(event); endDrag(event); }} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; }}>
    <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: `${range.start / range.duration * 100}%` }} />
    <div className="absolute inset-y-0 right-0 bg-black/60" style={{ width: `${(1 - range.end / range.duration) * 100}%` }} />
    <div className="absolute inset-y-0 flex cursor-grab items-center justify-center rounded-lg border-2 border-white" style={{ left: `${range.start / range.duration * 100}%`, width: `${(range.end - range.start) / range.duration * 100}%` }} onPointerDown={event => begin(event, "move")}>
      <span className="pointer-events-none whitespace-nowrap rounded-lg bg-black/80 px-2 py-1 text-sm text-white" title={`${formatCanvasAudioTime(range.start)} – ${formatCanvasAudioTime(range.end)}`}>{(range.end - range.start).toFixed(2)} s</span>
      {(["start", "end"] as const).map(side => <UiProps key={side} ids={{"aria-label":["canvas.m5f8ea4579523","canvas.mcea89d07c30e"]}}><div  role="slider" aria-label={side === "start" ? "canvas.m5f8ea4579523" : "canvas.mcea89d07c30e"} aria-valuemin={side === "start" ? 0 : range.start} aria-valuemax={side === "start" ? range.end : range.duration} aria-valuenow={range[side]} aria-disabled={busy} tabIndex={busy ? -1 : 0}
        className={`absolute inset-y-0 w-4 cursor-ew-resize rounded bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${side === "start" ? "-left-2" : "-right-2"}`}
        onPointerDown={event => begin(event, side)} onKeyDown={event => {
          if (busy || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const delta = event.key === "ArrowLeft" ? -.01 : .01;
          change(side === "start" ? Math.min(range.start + delta, range.end - .01) : range.start, side === "end" ? range.end + delta : range.end);
        }} /></UiProps>)}
    </div>
  </div>;
}
