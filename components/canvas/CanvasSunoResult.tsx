"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { useCanvasAudioPlayback } from "./CanvasAudioPlayback";
import { CanvasAudioNode } from "./CanvasAudioNode";
import type { CanvasNodeData } from "@/lib/canvas/document";
import type { CanvasAudioWaveformData } from "@/lib/canvas/audio-waveform";

type MusicData = Extract<CanvasNodeData, { kind: "audioTask" }>;

export function CanvasSunoResult({ id, data, onSelect, onExpand, onWaveformReady, headerActions }: {
  id: string; data: MusicData; onSelect: (index: number) => void; onExpand?: () => void;
  headerActions?: React.ReactNode;
  onWaveformReady: (waveform: CanvasAudioWaveformData) => void;
}) {
  const playback = useCanvasAudioPlayback(id);
  const [showLyrics, setShowLyrics] = React.useState(false);
  const tracks = data.audioOutputs || [];
  const selected = data.selectedAudioIndex || 0;
  const track = tracks[selected] || tracks[0];
  if (!track) return null;
  return <div className="flex h-full flex-col bg-[var(--panel-bg)] text-[var(--app-fg)]" data-canvas-suno-result>
    <div className="nodrag nopan flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 text-xs">
      {track.coverUrl && <UiProps ids={{"alt":["canvas.md63fe32e4d5f"]}}><img src={track.coverUrl} alt="canvas.md63fe32e4d5f" className="h-8 w-8 rounded object-cover" /></UiProps>}
      <UiProps ids={{"aria-label":["canvas.ma679a698b8e5"]}}><select aria-label="canvas.ma679a698b8e5" className="min-w-0 flex-1 bg-transparent outline-none" value={selected} onChange={e => { playback.stop(); setShowLyrics(false); onSelect(Number(e.target.value)); }}>
        {tracks.map((t, i) => <option key={t.audioIndex} value={i}>{t.audioIndex}. {t.title || <UiText id="canvas.mf172397b4920" />}</option>)}
      </select></UiProps>
      <span className="shrink-0 text-[var(--app-muted)]">{selected + 1}/{tracks.length}</span>
      {track.lyrics && <button type="button" className="shrink-0 whitespace-nowrap" aria-pressed={showLyrics} onClick={() => setShowLyrics(!showLyrics)}><UiText id="canvas.m9dbfa9b42bb3" /></button>}
      {tracks.length > 1 && onExpand && <UiProps ids={{"title":["canvas.mee341e768336"]}}><button type="button" className="shrink-0 whitespace-nowrap" onClick={onExpand} title="canvas.mee341e768336"><UiText id="canvas.m00bd3960fea8" /></button></UiProps>}
      {headerActions}
    </div>
    {showLyrics ? <div className="nodrag nopan nowheel min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap p-3 text-xs leading-relaxed">{track.lyrics}</div> : <div className="min-h-0 flex-1">
      <CanvasAudioNode key={track.audioIndex} id={id} selected={false}
        data={{ kind: "audio", origin: "generated", url: track.url, name: track.title, model: data.model,
          waveformPeaks: data.waveformPeaks, durationSeconds: track.durationSeconds }} onWaveformReady={onWaveformReady} />
    </div>}
  </div>;
}
