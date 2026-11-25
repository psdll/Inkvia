"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { Pause, Play } from "lucide-react";
import { useCanvasAudioPlayback } from "@/components/canvas/CanvasAudioPlayback";
import { CanvasAudioTrimSelection, useCanvasAudioTrim } from "./CanvasAudioTrim";
import type { CanvasNodeData } from "@/lib/canvas/document";
import {
  analyzeAudioUrlCached,
  CANVAS_AUDIO_WAVEFORM_PEAK_COUNT,
  createCanvasWaveformPath,
  formatCanvasAudioTime,
  type CanvasAudioWaveformData,
} from "@/lib/canvas/audio-waveform";

type CanvasAudioData = Extract<CanvasNodeData, { kind: "audio" }>;

type CanvasAudioNodeProps = {
  id: string;
  data: CanvasAudioData;
  selected: boolean;
  onWaveformReady: (waveform: CanvasAudioWaveformData) => void;
};

const WAVEFORM_WIDTH = 320;
const WAVEFORM_HEIGHT = 36;
const FALLBACK_PEAKS = Array.from({ length: CANVAS_AUDIO_WAVEFORM_PEAK_COUNT }, (_, index) =>
  14 + Math.round((Math.sin(index * 0.72) + 1) * 9),
);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function CanvasAudioNode({ id, data, selected, onWaveformReady }: CanvasAudioNodeProps) {
  const { snapshot, toggle, seek } = useCanvasAudioPlayback(id);
  const trim = useCanvasAudioTrim();
  const waveformRef = React.useRef<HTMLDivElement>(null);
  const seekDrag = React.useRef<{ pointerId: number; offsetX: number } | null>(null);
  const selectionAttemptedUrl = React.useRef<string | null>(null);
  const rawClipId = React.useId();
  const clipId = `canvas-audio-progress-${rawClipId.replace(/:/g, "")}`;
  const peaks = data.waveformPeaks ?? FALLBACK_PEAKS;
  const waveformPath = React.useMemo(() => createCanvasWaveformPath(peaks, WAVEFORM_WIDTH, WAVEFORM_HEIGHT), [peaks]);
  const duration = snapshot.active && snapshot.durationSeconds > 0
    ? snapshot.durationSeconds
    : (data.durationSeconds ?? 0);
  const currentTime = snapshot.active ? snapshot.currentTime : 0;
  const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const canSeek = Number.isFinite(duration) && duration > 0;

  React.useEffect(() => {
    if (trim?.range && snapshot.isPlaying && (currentTime >= trim.range.end || currentTime < trim.range.start)) {
      void toggle(data.url, duration);
    }
  }, [currentTime, data.url, duration, snapshot.isPlaying, toggle, trim?.range]);

  React.useEffect(() => {
    if (!selected || data.waveformPeaks || selectionAttemptedUrl.current === data.url) return;
    selectionAttemptedUrl.current = data.url;
    void analyzeAudioUrlCached(data.url).then(onWaveformReady).catch(() => undefined);
  }, [data.url, data.waveformPeaks, onWaveformReady, selected]);

  const analyzeOnPlay = React.useCallback(() => {
    if (data.waveformPeaks) return;
    void analyzeAudioUrlCached(data.url).then(onWaveformReady).catch(() => undefined);
  }, [data.url, data.waveformPeaks, onWaveformReady]);

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = seekDrag.current;
    const bounds = waveformRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !bounds || bounds.width <= 0 || !canSeek) return;
    event.stopPropagation();
    const ratio = clamp((event.clientX - bounds.left - drag.offsetX) / bounds.width, 0, 1);
    seek(data.url, ratio * duration, duration);
  };

  const endSeekDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (seekDrag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    seekDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      data-canvas-audio-node
      className={`flex h-full w-full flex-col overflow-hidden rounded-xl border bg-[var(--panel-bg)] px-3 py-2 shadow-[var(--shadow-2)] ${selected ? "border-[var(--primary-bg)]" : "border-[var(--border)]"}`}
    >
      <div
        data-waveform-ready={data.waveformPeaks ? "true" : "false"}
        className="my-1 min-h-0 flex-1 rounded-lg bg-[var(--input-bg)] px-1"
      >
        <div ref={waveformRef} data-canvas-audio-seek-track className="relative h-full w-full">
          <svg viewBox={`0 0 ${WAVEFORM_WIDTH} ${WAVEFORM_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" className="h-full w-full overflow-visible">
            <defs>
              <clipPath id={clipId}>
                <rect x="0" y="0" width={progress * WAVEFORM_WIDTH} height={WAVEFORM_HEIGHT} />
              </clipPath>
            </defs>
            <path d={waveformPath} fill="none" stroke="var(--app-muted)" strokeOpacity={data.waveformPeaks ? 0.48 : 0.22} strokeWidth="2.2" strokeLinecap="round" />
            <path d={waveformPath} fill="none" stroke="var(--primary-bg)" strokeWidth="2.2" strokeLinecap="round" clipPath={`url(#${clipId})`} />
          </svg>
          {!trim?.range && <UiProps ids={{"aria-label":["canvas.m644c496f6b22"],"title":["canvas.m79b51671f0f9"]}}><div
            data-canvas-audio-playhead
            role="slider"
            aria-label="canvas.m644c496f6b22"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={canSeek ? duration : 0}
            aria-valuenow={currentTime}
            aria-valuetext={`${formatCanvasAudioTime(currentTime)} / ${formatCanvasAudioTime(duration)}`}
            aria-disabled={!canSeek}
            tabIndex={canSeek ? 0 : -1}
            title="canvas.m79b51671f0f9"
            style={{ left: `${progress * 100}%` }}
            className="nodrag nopan absolute inset-y-0 flex w-4 -translate-x-1/2 touch-none select-none items-stretch justify-center rounded cursor-ew-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.button !== 0 || seekDrag.current || !canSeek) return;
              const bounds = waveformRef.current?.getBoundingClientRect();
              if (!bounds || bounds.width <= 0) return;
              event.preventDefault();
              seekDrag.current = { pointerId: event.pointerId, offsetX: event.clientX - bounds.left - progress * bounds.width };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={seekFromPointer}
            onPointerUp={(event) => { seekFromPointer(event); endSeekDrag(event); }}
            onPointerCancel={endSeekDrag}
            onLostPointerCapture={endSeekDrag}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              const seconds = event.key === "Home" ? 0 : event.key === "End" ? duration : event.key === "ArrowLeft" ? currentTime - 1 : event.key === "ArrowRight" ? currentTime + 1 : null;
              if (seconds === null || !canSeek) return;
              event.preventDefault();
              event.stopPropagation();
              seek(data.url, seconds, duration);
            }}
          >
            <span aria-hidden="true" className="my-0.5 w-0.5 rounded-full bg-[var(--color-danger,#ef4444)]" />
          </div></UiProps>}
          <CanvasAudioTrimSelection />
        </div>
      </div>

      <div data-canvas-audio-controls className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center">
        <span className="justify-self-start text-[10px] tabular-nums text-[var(--app-muted)]" title={snapshot.error ?? undefined}>
          {snapshot.error ? <UiText id="canvas.m20cca83dc94e" /> : `${formatCanvasAudioTime(currentTime)} / ${formatCanvasAudioTime(duration)}`}
        </span>
        <UiProps ids={{"aria-label":["canvas.m4e3a621c0ad3","canvas.m3cc14feed625"]}}><button
          data-canvas-audio-play-button
          type="button"
          aria-label={snapshot.isPlaying ? "canvas.m4e3a621c0ad3" : "canvas.m3cc14feed625"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            analyzeOnPlay();
            if (trim?.range && !snapshot.isPlaying) seek(data.url, trim.range.start, duration);
            void toggle(data.url, data.durationSeconds ?? 0);
          }}
          className="nodrag inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--input-bg)] text-[var(--app-fg)] transition-colors hover:border-[var(--primary-bg)] hover:text-[var(--primary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
        >
          {snapshot.isPlaying ? <Pause className="h-6 w-6" fill="currentColor" /> : <Play className="ml-px h-6 w-6" fill="currentColor" />}
        </button></UiProps>
        <span aria-hidden="true" />
      </div>
    </div>
  );
}
