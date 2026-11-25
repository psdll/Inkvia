"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { CanvasTaskParameterPopover } from "@/components/canvas/CanvasTaskParameterPopover";
import { CanvasParameterLabel } from "./CanvasParameterLabel";
import { SpeechSlider } from "@/components/canvas/CanvasSpeechParameters";
import type { CanvasNodeData } from "@/lib/canvas/document";
import { SEED_AUDIO_DEFAULT_FORMAT, SEED_AUDIO_DEFAULT_SAMPLE_RATE, SEED_AUDIO_FORMATS, SEED_AUDIO_SAMPLE_RATES, type SeedAudioFormat } from "@/lib/seed-audio-models";

type AudioTaskData = Extract<CanvasNodeData, { kind: "audioTask" }>;
type Props = { value: AudioTaskData; onChange: (patch: Partial<AudioTaskData>) => void };
const SAMPLE_RATE_OPTIONS = [8000, 16000, 24000, 48000];

export function CanvasSeedAudioOutputOptions({ value, onChange }: Props) {
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const format = value.audioFormat || SEED_AUDIO_DEFAULT_FORMAT;
  const sampleRate = value.sampleRate || (format === "ogg_opus" ? 48000 : SEED_AUDIO_DEFAULT_SAMPLE_RATE);
  const chooseFormat = (audioFormat: SeedAudioFormat) => onChange({
    audioFormat,
    sampleRate: SEED_AUDIO_SAMPLE_RATES[audioFormat].includes(sampleRate) ? sampleRate : audioFormat === "ogg_opus" ? 48000 : SEED_AUDIO_DEFAULT_SAMPLE_RATE,
  });

  return <>
    <UiProps ids={{"aria-label":["canvas.m32817a547c85"]}}><button ref={anchorRef} type="button" className="canvas-task-parameter-trigger canvas-video-mode-trigger canvas-seed-audio-output-trigger" aria-label="canvas.m32817a547c85" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)}>
      <span>{sampleRate / 1000}k · {format}</span><ChevronDown aria-hidden="true" className="h-3 w-3" />
    </button></UiProps>
    <CanvasTaskParameterPopover open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} width={344} maxHeight={520} side="top" align="start" className="canvas-video-advanced-popover canvas-audio-compact-popover">
      <UiProps ids={{"aria-label":["canvas.m32817a547c85"]}}><div className="canvas-task-parameter-sections canvas-param-card-sections" role="dialog" aria-label="canvas.m32817a547c85">
        <section className="canvas-task-parameter-section">
          <UiProps ids={{"label":["canvas.m0f549853799d"],"description":["canvas.me2d7e951a766"]}}><CanvasParameterLabel label="canvas.m0f549853799d" description="canvas.me2d7e951a766" /></UiProps>
          <UiProps ids={{"aria-label":["canvas.m0f549853799d"]}}><div className="grid grid-cols-4 gap-2" role="group" aria-label="canvas.m0f549853799d">{SAMPLE_RATE_OPTIONS.map((rate) => <UiProps key={rate} ids={{"title":["canvas.m9841399de2e8"]}}><button  type="button" className="canvas-task-parameter-option" data-selected={sampleRate === rate} aria-pressed={sampleRate === rate} disabled={!SEED_AUDIO_SAMPLE_RATES[format].includes(rate)} title={format === "ogg_opus" && rate !== 48000 ? "canvas.m9841399de2e8" : undefined} onClick={() => onChange({ sampleRate: rate })}>{rate / 1000}k</button></UiProps>)}</div></UiProps>
        </section>
        <section className="canvas-task-parameter-section">
          <UiProps ids={{"label":["canvas.m41d0e52f0a91"],"description":["canvas.m1d6cd2b74304"]}}><CanvasParameterLabel label="canvas.m41d0e52f0a91" description="canvas.m1d6cd2b74304" /></UiProps>
          <UiProps ids={{"aria-label":["canvas.m41d0e52f0a91"]}}><div className="grid grid-cols-3 gap-2" role="group" aria-label="canvas.m41d0e52f0a91">{SEED_AUDIO_FORMATS.map((item) => <button key={item} type="button" className="canvas-task-parameter-option" data-selected={format === item} aria-pressed={format === item} onClick={() => chooseFormat(item)}>{item}</button>)}</div></UiProps>
        </section>
        {format === "pcm" && <p className="text-[11px] leading-relaxed text-[var(--canvas-controls-text-muted)]"><UiText id="canvas.m3695f62c298a" /></p>}
      </div></UiProps>
    </CanvasTaskParameterPopover>
  </>;
}

export function CanvasSeedAudioParameters({ value, onChange }: Props) {
  return <UiProps ids={{"aria-label":["canvas.meb14ae81d80d"]}}><div className="canvas-task-parameter-sections canvas-param-card-sections" role="group" aria-label="canvas.meb14ae81d80d">
    <UiProps ids={{"label":["canvas.mcd97a36868f3"],"description":["canvas.mdd3152740a10"]}}><SpeechSlider label="canvas.mcd97a36868f3" description="canvas.mdd3152740a10" value={value.speed} min={0.5} max={2} step={0.01} onChange={(speed) => onChange({ speed })} /></UiProps>
    <UiProps ids={{"label":["canvas.m102e1b22c184"],"description":["canvas.m3d63da010572"]}}><SpeechSlider label="canvas.m102e1b22c184" description="canvas.m3d63da010572" value={value.pitch} min={-12} max={12} step={1} onChange={(pitch) => onChange({ pitch })} /></UiProps>
    <UiProps ids={{"label":["canvas.m8bf8b9780d34"],"description":["canvas.mba019ee02eb6"]}}><SpeechSlider label="canvas.m8bf8b9780d34" description="canvas.mba019ee02eb6" value={value.volume} min={0.5} max={2} step={0.01} onChange={(volume) => onChange({ volume })} /></UiProps>
    <UiProps ids={{"title":["canvas.m6a0e6c6ec85f"]}}><button type="button" className="flex items-center justify-center gap-1 self-end text-[11px] text-[var(--canvas-controls-text-muted)] hover:text-[var(--canvas-controls-text)]" title="canvas.m6a0e6c6ec85f" onClick={() => onChange({ speed: 1, pitch: 0, volume: 1 })}><RotateCcw className="h-3 w-3" aria-hidden="true" /><UiText id="canvas.m9ad3f1a7c6b8" /></button></UiProps>
  </div></UiProps>;
}
