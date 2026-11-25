"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { Handle, Position, useStore } from "@xyflow/react";
import { Columns2, GripVertical, Pause, Play } from "lucide-react";
import type { CanvasNodeData } from "@/lib/canvas/document";
import { getCanvasCompareMedia } from "@/lib/canvas/image-compare";
import { CANVAS_TASK_BODY_TARGET_HANDLE_ID } from "@/lib/canvas/connection-rules";
import { scheduleCanvasConnectionTargetTilt, resetCanvasConnectionTargetTilt, type CanvasConnectionCandidateState } from "@/lib/canvas/connection-feedback";
import { CanvasNodeEditorContext, type CanvasFlowNode } from "./CanvasNodeCard";
import { CanvasEditableNodeName } from "./CanvasEditableNodeName";
import { renameCanvasNodeData } from "@/lib/canvas/material-name";
import { CanvasMediaImage } from "./CanvasMediaImage";

type CompareData = Extract<CanvasNodeData, { kind: "compare" }>;

export function CanvasImageCompareView({ before, after, kind = "image", slider, onCommit }: {
  before: string; after: string; kind?: "image" | "video" | null; slider: number; onCommit: (value: number) => void;
}) {
  const frame = React.useRef<HTMLDivElement>(null);
  const firstVideo = React.useRef<HTMLVideoElement>(null);
  const secondVideo = React.useRef<HTMLVideoElement>(null);
  const [position, setPosition] = React.useState(slider);
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [videoError, setVideoError] = React.useState(false);
  React.useEffect(() => setPosition(slider), [slider]);
  React.useEffect(() => {
    const videos = [firstVideo.current, secondVideo.current].filter((video): video is HTMLVideoElement => Boolean(video));
    let cancelled = false;
    if (playing) {
      const start = videos[0]?.currentTime || 0;
      videos.forEach(video => { video.currentTime = start; });
      void Promise.all(videos.map(video => video.play())).catch(() => {
        if (!cancelled) { setPlaying(false); setVideoError(true); }
      });
    } else videos.forEach(video => video.pause());
    return () => { cancelled = true; videos.forEach(video => video.pause()); };
  }, [playing, before, after, kind]);
  const updateDuration = () => {
    const durations = [firstVideo.current?.duration, secondVideo.current?.duration];
    setDuration(durations.every(value => value && Number.isFinite(value)) ? Math.min(...durations as number[]) : 0);
  };
  const seek = (value: number) => {
    for (const video of [firstVideo.current, secondVideo.current]) if (video) video.currentTime = value;
    setTime(value);
  };
  const syncPlayback = () => {
    const first = firstVideo.current;
    const second = secondVideo.current;
    if (!first || !second) return;
    if (playing && duration && first.currentTime >= duration) {
      setPlaying(false);
      seek(duration);
      return;
    }
    if (Math.abs(second.currentTime - first.currentTime) > 0.12) second.currentTime = first.currentTime;
    setTime(first.currentTime);
  };
  const pointerPosition = (clientX: number) => {
    const bounds = frame.current?.getBoundingClientRect();
    return bounds?.width ? Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) : position;
  };
  const paired = Boolean(before && after);
  return <div className="relative h-full w-full">
    <div ref={frame} data-canvas-image-compare className="relative h-full w-full overflow-hidden rounded-xl bg-[var(--input-bg)]">
    {before || after ? kind === "video"
      ? <UiProps ids={{"aria-label":["canvas.m528ceecd82c9"]}}><video ref={firstVideo} src={before || after} aria-label="canvas.m528ceecd82c9" muted playsInline preload="auto" className="pointer-events-none absolute inset-0 h-full w-full object-contain" onLoadedMetadata={updateDuration} onDurationChange={updateDuration} onTimeUpdate={syncPlayback} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setVideoError(true); }} /></UiProps>
      : <UiProps ids={{"alt":["canvas.m6d9590f48a1b"]}}><CanvasMediaImage src={before || after} alt="canvas.m6d9590f48a1b" draggable={false} className="absolute inset-0 h-full w-full object-contain" /></UiProps>
      : <div className="flex h-full items-center justify-center px-5 text-center text-sm text-[var(--app-muted)]">{kind === "video" ? <UiText id="canvas.mce7bf3a659a3" /> : kind === "image" ? <UiText id="canvas.m9682087806c4" /> : <UiText id="canvas.m8dffef8eb892" />}</div>}
    {paired && <>
      <div data-canvas-compare-after className="pointer-events-none absolute inset-0 bg-[var(--input-bg)]" style={{ clipPath: `inset(0 0 0 ${position * 100}%)` }}>
        {kind === "video"
          ? <UiProps ids={{"aria-label":["canvas.m3ab426dfa710"]}}><video ref={secondVideo} src={after} aria-label="canvas.m3ab426dfa710" muted playsInline preload="auto" className="h-full w-full object-contain" onLoadedMetadata={updateDuration} onDurationChange={updateDuration} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setVideoError(true); }} /></UiProps>
          : <UiProps ids={{"alt":["canvas.mb0df9826be7a"]}}><CanvasMediaImage src={after} alt="canvas.mb0df9826be7a" draggable={false} className="h-full w-full object-contain" /></UiProps>}
      </div>
      <UiProps ids={{"aria-label":["canvas.m3dcaad5b79be","canvas.m7eea2732881f"]}}><div
        role="slider" aria-label={kind === "video" ? "canvas.m3dcaad5b79be" : "canvas.m7eea2732881f"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position * 100)} tabIndex={0}
        className="nodrag nopan nowheel absolute inset-y-0 z-10 w-8 -translate-x-1/2 cursor-ew-resize touch-none outline-none focus-visible:bg-white/10"
        style={{ left: `${position * 100}%` }}
        onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setPosition(pointerPosition(event.clientX)); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPosition(pointerPosition(event.clientX)); }}
        onPointerUp={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const next = pointerPosition(event.clientX);
          event.currentTarget.releasePointerCapture(event.pointerId);
          setPosition(next);
          onCommit(next);
        }}
        onPointerCancel={() => setPosition(slider)}
        onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : event.key === "ArrowLeft" ? Math.max(0, position - 0.01) : event.key === "ArrowRight" ? Math.min(1, position + 0.01) : null;
          if (next === null) return;
          event.preventDefault(); event.stopPropagation(); setPosition(next); onCommit(next);
        }}
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-white shadow-sm" />
        <span className="absolute left-1/2 top-1/2 flex h-8 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-sm"><GripVertical className="h-4 w-4" /></span>
      </div></UiProps>
    </>}
    {videoError && <div role="status" className="pointer-events-none absolute inset-x-2 top-2 z-20 rounded bg-black/70 p-2 text-center text-xs text-white"><UiText id="canvas.m1313e4d08e04" /></div>}
    {!paired && (before || after) && <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[var(--panel-bg)] px-3 py-2 text-center text-xs text-[var(--app-muted)]">{kind === "video" ? <UiText id="canvas.m637d9b88491e" /> : <UiText id="canvas.mf0c54d7af376" />}</div>}
    </div>
    {paired && kind === "video" && <div className="group/compare-controls nodrag nopan nowheel absolute inset-x-0 bottom-0 z-20 flex h-10 items-end p-1.5" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <div className="flex w-full items-center gap-1.5 rounded-md bg-black/55 px-1.5 py-1 text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover/compare-controls:opacity-100 group-has-[:focus-visible]/compare-controls:opacity-100 group-has-[:active]/compare-controls:opacity-100 motion-reduce:transition-none">
      <UiProps ids={{"aria-label":["canvas.m62cb96e4dc8a","canvas.m45e18351409c"]}}><button type="button" disabled={!duration} aria-label={playing ? "canvas.m62cb96e4dc8a" : "canvas.m45e18351409c"} className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/15 disabled:opacity-40" onClick={() => { if (!playing && time >= duration) seek(0); setVideoError(false); setPlaying(value => !value); }}>
        {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button></UiProps>
      <UiProps ids={{"aria-label":["canvas.m157a71b012b1"]}}><input type="range" aria-label="canvas.m157a71b012b1" min={0} max={duration || 1} step={0.01} value={Math.min(time, duration)} disabled={!duration} onChange={event => seek(Number(event.target.value))} className="h-1 min-w-0 flex-1 cursor-pointer accent-white [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5" /></UiProps>
      <span className="shrink-0 text-[9px] tabular-nums text-white/80">{time.toFixed(1)} / {duration.toFixed(1)}s</span>
      </div>
    </div>}
  </div>;
}

export function CanvasImageCompareNode({ id, data, width = 350, height = 350, selected, connectionInProgress, connectionTargetState }: {
  id: string; data: CompareData; width?: number; height?: number; selected: boolean;
  connectionInProgress: boolean; connectionTargetState: CanvasConnectionCandidateState;
}) {
  const editor = React.useContext(CanvasNodeEditorContext);
  const targetFrame = React.useRef<HTMLDivElement>(null);
  // Subscribe to displayed URLs, so source replacement/undo updates even when this node is unselected.
  const media = useStore(state => JSON.stringify(getCanvasCompareMedia(id, state.nodes as CanvasFlowNode[], state.edges, data)));
  const { kind, before, after } = JSON.parse(media) as ReturnType<typeof getCanvasCompareMedia>;
  return <div data-canvas-connection-target-id={id} data-canvas-material-target-state={connectionTargetState || undefined}
    className={`group/material relative ${connectionTargetState === "invalid" ? "canvas-connection-target-invalid-frame" : ""}`} style={{ width, height }}
    onPointerMove={event => {
      if (connectionTargetState === "valid" && targetFrame.current) scheduleCanvasConnectionTargetTilt(targetFrame.current, { x: event.clientX, y: event.clientY });
    }}
    onPointerLeave={() => { if (targetFrame.current) resetCanvasConnectionTargetTilt(targetFrame.current); }}>
    <div className="pointer-events-none absolute -top-7 left-0 flex items-center gap-1.5 text-xs text-[var(--app-muted)]"><Columns2 className="h-3.5 w-3.5" /><CanvasEditableNodeName name={!data.title || data.title === "图片对比" ? "对比" : data.title} onRename={value => editor?.updateData(id, current => renameCanvasNodeData(current, value), "push")} /></div>
    <Handle type="target" position={Position.Left} isConnectableStart={false} className="!h-5 !w-5 !border-[var(--border)] !bg-[var(--panel-bg)]" />
    <Handle id={CANVAS_TASK_BODY_TARGET_HANDLE_ID} data-canvas-compare-body-target type="target" position={Position.Left}
      isConnectableStart={false} isConnectableEnd
      className="!z-20 !rounded-[inherit] !border-0 !bg-transparent !opacity-0"
      style={{ inset: -20, width: "auto", height: "auto", transform: "none", pointerEvents: connectionInProgress ? "auto" : "none" }} />
    <div ref={targetFrame} data-canvas-connection-target-state={connectionTargetState || undefined}
      className={`canvas-material-frame canvas-connection-target h-full w-full ${selected ? "canvas-material-frame-selected" : ""} ${connectionTargetState === "valid" ? "canvas-connection-target-valid" : ""} ${connectionTargetState === "invalid" ? "canvas-connection-target-invalid" : ""}`}>
      <CanvasImageCompareView key={JSON.stringify([kind, before, after])} kind={kind} before={before} after={after} slider={data.slider} onCommit={slider => editor?.updateData(id, current => current.kind === "compare" ? { ...current, slider } : current, "push")} />
    </div>
  </div>;
}
