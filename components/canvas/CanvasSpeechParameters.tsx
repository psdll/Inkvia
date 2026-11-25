"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { RotateCcw } from "lucide-react";
import { CanvasParameterLabel } from "./CanvasParameterLabel";
import { getMiniMaxSpeechCapabilities, MINIMAX_SPEECH_SOUND_EFFECTS, type MiniMaxSpeechSettings } from "@/lib/minimax-speech-models";

type Parameters = Omit<MiniMaxSpeechSettings, "model" | "voiceId" | "text">;

export function SpeechSlider({ label, description, value, min, max, step, onChange }: {
  label: string; description: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  const { text } = useUiLocale();
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const number = Number(draft);
    const next = draft.trim() && Number.isFinite(number) ? Math.min(max, Math.max(min, step === 1 ? Math.round(number) : number)) : value;
    setDraft(String(next));
    onChange(next);
  };
  return <div className="canvas-audio-parameter-slider">
    <CanvasParameterLabel label={label} description={description} />
    <div className="canvas-video-duration-row">
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} style={{ "--canvas-video-duration-progress": `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} onChange={(event) => onChange(Number(event.target.value))} />
    <input className="h-7 w-full rounded-lg border-0 bg-[var(--canvas-task-param-active)] p-0 text-center text-xs text-[var(--canvas-controls-text)] outline-none" type="text" inputMode="decimal" aria-label={text("workspaceFollowup.md2f017c38e36", { v0: label })} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); commit(); }
    }} />
    </div>
  </div>;
}

const EMOTION_LABELS = { calm: "平静", happy: "高兴", sad: "悲伤", angry: "愤怒", fearful: "害怕", disgusted: "厌恶", surprised: "惊讶" };

export function CanvasSpeechParameters({ model, value, onChange }: {
  model: string; value: Parameters; onChange: (patch: Partial<Parameters>) => void;
}) {
  const { text, label: uiLabel } = useUiLocale();
  const capabilities = getMiniMaxSpeechCapabilities(model);
  if (!capabilities.parameters) return null;
  return <UiProps ids={{"aria-label":["canvas.m07aeba516047"]}}><div className="canvas-task-parameter-sections canvas-param-card-sections" role="group" aria-label="canvas.m07aeba516047">
    <UiProps ids={{"label":["canvas.mcd97a36868f3"],"description":["canvas.mdd3152740a10"]}}><SpeechSlider label="canvas.mcd97a36868f3" description="canvas.mdd3152740a10" value={value.speed} min={0.5} max={2} step={0.01} onChange={(speed) => onChange({ speed })} /></UiProps>
    <UiProps ids={{"label":["canvas.m102e1b22c184"],"description":["canvas.m3d63da010572"]}}><SpeechSlider label="canvas.m102e1b22c184" description="canvas.m3d63da010572" value={value.pitch} min={-12} max={12} step={1} onChange={(pitch) => onChange({ pitch })} /></UiProps>
    <UiProps ids={{"label":["canvas.m8bf8b9780d34"],"description":["canvas.m31e445e2716f"]}}><SpeechSlider label="canvas.m8bf8b9780d34" description="canvas.m31e445e2716f" value={value.volume} min={0.01} max={10} step={0.01} onChange={(volume) => onChange({ volume })} /></UiProps>
    <UiProps ids={{"label":["canvas.m8fb65b97b8dc"],"description":["canvas.m3ca98d8bc5aa"]}}><SpeechSlider label="canvas.m8fb65b97b8dc" description="canvas.m3ca98d8bc5aa" value={value.modifyPitch} min={-100} max={100} step={1} onChange={(modifyPitch) => onChange({ modifyPitch })} /></UiProps>
    <UiProps ids={{"label":["canvas.ma2846644a638"],"description":["canvas.m5d0ae40d1726"]}}><SpeechSlider label="canvas.ma2846644a638" description="canvas.m5d0ae40d1726" value={value.modifyIntensity} min={-100} max={100} step={1} onChange={(modifyIntensity) => onChange({ modifyIntensity })} /></UiProps>
    <UiProps ids={{"label":["canvas.m1a801352c505"],"description":["canvas.m755dd3e567a8"]}}><SpeechSlider label="canvas.m1a801352c505" description="canvas.m755dd3e567a8" value={value.modifyTimbre} min={-100} max={100} step={1} onChange={(modifyTimbre) => onChange({ modifyTimbre })} /></UiProps>
    <section className="canvas-task-parameter-section">
      <UiProps ids={{"label":["canvas.m5e9d80d0e3c3"],"description":["canvas.m93014ed88ebf"]}}><CanvasParameterLabel label="canvas.m5e9d80d0e3c3" description="canvas.m93014ed88ebf" /></UiProps>
      <UiProps ids={{"aria-label":["canvas.m5e9d80d0e3c3"]}}><div className="grid grid-cols-3 gap-2" role="group" aria-label="canvas.m5e9d80d0e3c3">{MINIMAX_SPEECH_SOUND_EFFECTS.map((effect) => <button key={effect.value} type="button" className="canvas-task-parameter-option" data-selected={value.soundEffect === effect.value} aria-pressed={value.soundEffect === effect.value} onClick={() => onChange({ soundEffect: effect.value })}>{effect.label}</button>)}</div></UiProps>
    </section>
    {capabilities.emotions.length > 0 && <section className="canvas-task-parameter-section">
      <div className="canvas-task-parameter-label flex items-center justify-between"><UiProps ids={{"label":["canvas.m7f1bc9fc4867"],"description":["canvas.mdd7bedcb0fb8"]}}><CanvasParameterLabel label="canvas.m7f1bc9fc4867" description="canvas.mdd7bedcb0fb8" /></UiProps> <span className="text-[11px] font-normal">{value.emotion ? <UiText id="canvas.m954cce113c74" /> : <UiText id="canvas.m7eb336e42cb5" />}</span></div>
      <UiProps ids={{"aria-label":["canvas.m7f1bc9fc4867"]}}><div className="grid grid-cols-3 gap-2" role="group" aria-label="canvas.m7f1bc9fc4867">{capabilities.emotions.map((emotion) => <button key={emotion} type="button" className="canvas-task-parameter-option" title={text("workspaceFollowup.m59b900af341e", { v0: uiLabel(EMOTION_LABELS[emotion]) })} data-selected={value.emotion === emotion} aria-pressed={value.emotion === emotion} onClick={() => onChange({ emotion: value.emotion === emotion ? undefined : emotion })}>{emotion}</button>)}</div></UiProps>
    </section>}
    <UiProps ids={{"title":["canvas.m6a0e6c6ec85f"]}}><button type="button" className="flex items-center justify-center gap-1 self-end text-[11px] text-[var(--canvas-controls-text-muted)] hover:text-[var(--canvas-controls-text)]" title="canvas.m6a0e6c6ec85f" onClick={() => onChange({ speed: 1, pitch: 0, volume: 1 })}><RotateCcw className="h-3 w-3" aria-hidden="true" /><UiText id="canvas.m9ad3f1a7c6b8" /></button></UiProps>
  </div></UiProps>;
}
