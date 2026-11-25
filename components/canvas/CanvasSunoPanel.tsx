"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ArrowUp, Loader2, RotateCcw, Settings2 } from "lucide-react";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { CanvasGeneratorShell } from "./CanvasGeneratorShell";
import { CanvasTaskParameterPopover } from "./CanvasTaskParameterPopover";
import { CanvasParameterLabel } from "./CanvasParameterLabel";
import { buildSunoRequest, type SunoSettings } from "@/lib/suno-models";

const inputClass = "nodrag nopan w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-[13px] text-[var(--app-fg)] outline-none focus:border-[var(--app-muted)] disabled:opacity-50";
const parameterHelp: Record<string, string> = {
  "创意度": "调整音乐创作的自由度，范围 0–100%。想尝试更多变化时可逐步调高。未手动调整时使用模型默认策略。",
  "风格影响": "控制风格描述的权重，范围 0–100%。希望更贴近填写的曲风时可调高；未手动调整时使用模型默认策略。",
  "人声": "选择男声或女声；自动表示交给模型决定。纯音乐模式下不使用人声设置。",
  "风格变化": "控制风格变化程度，从关闭、普通到最高逐步增加。“默认”交给模型决定；这里的“最高”与收费的 Max 模式是两个不同选项。",
  "目标时长": "填写希望生成的时长，范围 10–360 秒；留空为自动。实际时长以生成结果为准。",
  "排除风格": "填写不希望出现的曲风或声音元素，例如 metal, screaming。仅在自定义模式生效。",
  "歌词二次创作": "开启后允许模型再次创作输入的歌词；希望尽量保留自己写的歌词时保持关闭。仅在自定义、有歌词时使用。",
  "输出格式": "选择音乐文件格式：MP3 便于分享，M4A 适合压缩存储，WAV 适合后期处理。自动表示使用平台默认格式。",
  "Max 模式": "自定义模式的额外生成选项，开启后本次费用为普通模式的 2 倍。不确定时保持关闭。",
};
const length = (value = "") => [...value].length;
function Toggle({ label, value, onChange, disabled, className = "flex shrink-0 items-center gap-2 text-xs disabled:opacity-50" }: { label: string; value?: boolean; onChange: (value: boolean) => void; disabled?: boolean; className?: string }) {
  const { label: uiLabel } = useUiLocale();
  return <button type="button" role="switch" aria-label={uiLabel(label)} aria-checked={Boolean(value)} disabled={disabled} onClick={() => onChange(!value)} className={`nodrag ${className}`}>
    <span className={`relative h-[18px] w-8 rounded-full transition-colors ${value ? "bg-[var(--primary-bg)]" : "bg-[var(--border)]"}`}><span className={`absolute left-0 top-[3px] h-3 w-3 rounded-full transition-transform ${value ? "translate-x-[17px] bg-[var(--panel-bg)]" : "translate-x-[3px] bg-white"}`} /></span>{uiLabel(label)}
  </button>;
}

export function CanvasSunoPanel({ id, model, value = {}, models, running, readOnly, referenceText, onChange, onModelChange, onRun }: {
  id: string; model: string; value?: SunoSettings;
  models: { value: string; label: string; disabled?: boolean; hint?: string }[];
  running: boolean; readOnly: boolean; referenceText?: string;
  onChange: (value: SunoSettings) => void; onModelChange: (model: string) => void; onRun: () => void;
}) {
  const { text, label: uiLabel } = useUiLocale();
  const [open, setOpen] = React.useState(false);
  const anchor = React.useRef<HTMLButtonElement>(null);
  const s = value;
  const disabled = readOnly || running;
  const update = (patch: Partial<SunoSettings>) => onChange({ ...s, ...patch });
  let invalid = "";
  try { buildSunoRequest({ model, suno: s, ...(referenceText ? { text: [s.custom ? s.lyrics : s.description, referenceText].filter(Boolean).join("\n\n") } : {}) }); }
  catch (e) { invalid = e instanceof Error ? e.message : "请检查音乐参数"; }
  const choices = (label: string, val: string, options: { value: string; label: string }[], change: (v: string) => void) => <section className="canvas-task-parameter-section"><CanvasParameterLabel label={uiLabel(label)} description={uiLabel(parameterHelp[label])} /><div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${(options.length === 4 ? 4 : Math.min(options.length, 3))}, minmax(0, 1fr))` }} role="group" aria-label={uiLabel(label)}>{options.map(option => <button key={option.value} type="button" className="canvas-task-parameter-option" disabled={disabled} data-selected={val === option.value} aria-pressed={val === option.value} onClick={() => change(option.value)}>{uiLabel(option.label)}</button>)}</div></section>;
  const weight = (label: string, key: "styleWeight" | "weirdness") => <section className="canvas-audio-parameter-slider">
    <CanvasParameterLabel label={uiLabel(label)} description={uiLabel(parameterHelp[label])} />
    <div className="canvas-video-duration-row">
      <input id={`${id}-${key}`} type="range" aria-label={uiLabel(label)} min={0} max={100} step={1} disabled={disabled} value={Math.round((s[key] ?? 0.5) * 100)} style={{ "--canvas-video-duration-progress": `${Math.round((s[key] ?? 0.5) * 100)}%` } as React.CSSProperties} onChange={event => update({ [key]: Number(event.target.value) / 100 })} />
      <input type="number" aria-label={text("workspaceFollowup.md2f017c38e36", { v0: label })} min={0} max={100} step={1} disabled={disabled} value={Math.round((s[key] ?? 0.5) * 100)} onChange={event => { if (event.target.value !== "") update({ [key]: Math.min(100, Math.max(0, Math.round(Number(event.target.value)))) / 100 }); }} className="h-7 w-full rounded-lg border-0 bg-[var(--canvas-task-param-active)] p-0 text-center text-xs text-[var(--canvas-controls-text)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
    </div>
  </section>;
  return <UiProps ids={{"title":["canvas.md38903928e35"]}}><CanvasGeneratorShell nodeId={id} title="canvas.md38903928e35">{expanded => <div data-canvas-task-panel data-canvas-audio-task-panel data-canvas-suno-panel className="canvas-generator-content" onKeyDown={event => {
    if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); if (!disabled && !invalid) onRun(); }
  }}>
    <UiProps ids={{"aria-label":["canvas.mb77f2131dbae"]}}><div role="tablist" aria-label="canvas.mb77f2131dbae" className={`${s.custom ? "mb-3 " : ""}flex w-fit gap-1 rounded-lg bg-[var(--panel-2)] p-1`}>
      {[false, true].map(custom => <button key={String(custom)} type="button" role="tab" aria-selected={Boolean(s.custom) === custom} disabled={disabled} onClick={() => update({ custom })} className={`nodrag rounded-md px-3 py-1 text-xs ${Boolean(s.custom) === custom ? "bg-[var(--input-bg)] text-[var(--app-fg)]" : "text-[var(--app-muted)]"}`}>{custom ? <UiText id="canvas.m4eafa9e925b3" /> : <UiText id="canvas.m674a5c6c5653" />}</button>)}
    </div></UiProps>
    <div className={`min-h-0 space-y-3 overflow-y-auto ${expanded ? "flex-1" : "max-h-[330px]"} ${!s.custom && expanded ? "flex flex-col" : ""}`}>
      {!s.custom ? <div className={`canvas-generator-prompt-surface${expanded ? " canvas-generator-prompt-surface--expanded min-h-0 flex-1" : ""}`}><UiProps ids={{"aria-label":["canvas.m9a6ce723c85f"],"placeholder":["canvas.mfcb2e63a03df"]}}><textarea aria-label="canvas.m9a6ce723c85f" disabled={disabled} value={s.description || ""} onChange={e => update({ description: e.target.value })} placeholder="canvas.mfcb2e63a03df" className="canvas-generator-prompt-viewport nodrag nowheel w-full resize-none border-0 p-0 text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)] disabled:opacity-50" /></UiProps></div> : <>
        {!s.instrumental && <label className="block"><span className="mb-1.5 flex justify-between text-xs"><UiText id="canvas.m9dbfa9b42bb3" /><span className="text-[var(--app-muted)]">{length(s.lyrics)}/5000</span></span><UiProps ids={{"aria-label":["canvas.m9dbfa9b42bb3"],"placeholder":["canvas.m2f40b6efb5ef"]}}><textarea aria-label="canvas.m9dbfa9b42bb3" disabled={disabled} value={s.lyrics || ""} onChange={e => update({ lyrics: e.target.value })} placeholder="canvas.m2f40b6efb5ef" className={`${inputClass} min-h-[100px] resize-y`} /></UiProps></label>}
        <label className="block"><span className="mb-1.5 flex justify-between text-xs"><UiText id="canvas.m19190cb1a45a" /><span className="text-[var(--app-muted)]">{length(s.style)}/1000</span></span><UiProps ids={{"aria-label":["canvas.m19190cb1a45a"],"placeholder":["canvas.m945d28e0cc78"]}}><textarea aria-label="canvas.m19190cb1a45a" disabled={disabled} value={s.style || ""} onChange={e => update({ style: e.target.value })} rows={2} placeholder="canvas.m945d28e0cc78" className={`${inputClass} resize-none`} /></UiProps></label>
        <UiProps ids={{"aria-label":["canvas.m468407e0c5b2"],"placeholder":["canvas.m74737bb03fdb"]}}><input aria-label="canvas.m468407e0c5b2" disabled={disabled} value={s.title || ""} onChange={e => update({ title: e.target.value })} placeholder="canvas.m74737bb03fdb" className={inputClass} /></UiProps>
      </>}
      {referenceText && !(s.custom && s.instrumental) && <p className="text-[11px] text-[var(--app-muted)]"><UiText id="canvas.mc8cd7e561401" />{s.custom ? <UiText id="canvas.m9dbfa9b42bb3" /> : <UiText id="canvas.m9a6ce723c85f" />}</p>}
    </div>
    {invalid && !/请输入/.test(invalid) && <p role="alert" className="text-xs text-red-400">{invalid}</p>}
    <div className={`canvas-video-task-footer${s.custom ? " mt-3" : ""}`}>
      <div className="canvas-task-parameter-bar min-w-0 flex-1">
        <FrostedSelect value={model} onChange={v => { setOpen(false); onModelChange(v); }} options={models} disabled={disabled} ariaLabel={text("workspaceFollowup.m2aad9b7e45f8")} buttonClassName="canvas-task-model-trigger canvas-video-model-trigger !h-8 min-w-[88px] max-w-[240px]" menuClassName="canvas-task-parameter-popover canvas-video-model-menu" variant="canvas" showLeading={false} side="top" menuWidth={304} menuMaxHeight={400} optionHeight={52} />
        <div className="canvas-task-parameter-divider" aria-hidden="true" />
        <UiProps ids={{"label":["canvas.m7fd91a209fd4"]}}><Toggle label="canvas.m7fd91a209fd4" value={s.instrumental} onChange={instrumental => update({ instrumental })} disabled={disabled} className="canvas-task-parameter-trigger canvas-video-mode-trigger !h-8 !gap-2" /></UiProps>
        <div className="canvas-task-parameter-divider" aria-hidden="true" />
        <UiProps ids={{"aria-label":["canvas.m53c3e71c6990"],"title":["canvas.m53c3e71c6990"]}}><button ref={anchor} type="button" aria-label="canvas.m53c3e71c6990" title="canvas.m53c3e71c6990" aria-expanded={open} aria-haspopup="dialog" data-open={open || undefined} disabled={readOnly} onClick={() => setOpen(!open)} className="canvas-task-parameter-trigger !h-8 !px-2"><Settings2 className="h-4 w-4" /></button></UiProps>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--app-muted)]">{!s.custom && <span>{length(s.description)}/3000</span>}{s.custom && s.maxMode && <span><UiText id="canvas.me15813dfd03e" /></span>}<UiProps ids={{"aria-label":["canvas.me0d47bf944dd","canvas.m01371015de65"],"title":["canvas.m01371015de65"]}}><button type="button" disabled={disabled || Boolean(invalid)} onClick={onRun} aria-label={running ? "canvas.me0d47bf944dd" : "canvas.m01371015de65"} title={invalid || "canvas.m01371015de65"} className="canvas-task-submit-button nodrag">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3 w-3" />}</button></UiProps></div>
    </div>
    <CanvasTaskParameterPopover open={open} anchorRef={anchor} onClose={() => setOpen(false)} width={344} maxHeight={520} align="start" side="top" className="canvas-video-advanced-popover canvas-audio-compact-popover">
      <UiProps ids={{"aria-label":["canvas.m53c3e71c6990"]}}><div className="canvas-task-parameter-sections canvas-param-card-sections" role="group" aria-label="canvas.m53c3e71c6990" data-suno-parameters>
        {weight("创意度", "weirdness")}{weight("风格影响", "styleWeight")}
        {!s.instrumental && choices("人声", s.vocalGender || "auto", [{ value: "auto", label: text("workspaceFollowup.m7eb336e42cb5") }, { value: "Male", label: text("workspaceFollowup.m221a8fbb1cc2") }, { value: "Female", label: text("workspaceFollowup.m12a25ecd3917") }], v => update({ vocalGender: v === "auto" ? undefined : v as SunoSettings["vocalGender"] }))}
        {s.custom && <label className="canvas-task-parameter-section"><UiProps ids={{"label":["canvas.mecfc08c8b5a3"]}}><CanvasParameterLabel label="canvas.mecfc08c8b5a3" description={parameterHelp[text("workspaceFollowup.mecfc08c8b5a3")]} /></UiProps><UiProps ids={{"aria-label":["canvas.mecfc08c8b5a3"],"placeholder":["canvas.mad2fc4f700a3"]}}><input aria-label="canvas.mecfc08c8b5a3" type="number" min={10} max={360} step={1} disabled={disabled} value={s.duration ?? ""} onChange={e => update({ duration: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="canvas.mad2fc4f700a3" className="canvas-task-parameter-input" /></UiProps></label>}
        {choices("风格变化", s.variety || "auto", ["auto", "off", "normal", "high", "extra", "max"].map((v, i) => ({ value: v, label: [text("workspaceFollowup.m844b8cc8dff7"), text("workspaceFollowup.m3fd47edce45b"), text("workspaceFollowup.mde907d10df98"), text("workspaceFollowup.mb1c27820fec2"), text("workspaceFollowup.ma362aecad54a"), text("workspaceFollowup.m8672864e9041")][i] })), v => update({ variety: v === "auto" ? undefined : v as SunoSettings["variety"] }))}
        {s.custom && <>
          <label className="canvas-task-parameter-section"><UiProps ids={{"label":["canvas.m0c5c1225f0e7"]}}><CanvasParameterLabel label="canvas.m0c5c1225f0e7" description={parameterHelp[text("workspaceFollowup.m0c5c1225f0e7")]} /></UiProps><UiProps ids={{"aria-label":["canvas.m0c5c1225f0e7"],"placeholder":["canvas.mf01c5ea7ce65"]}}><input aria-label="canvas.m0c5c1225f0e7" value={s.negativeTags || ""} disabled={disabled} onChange={e => update({ negativeTags: e.target.value })} placeholder="canvas.mf01c5ea7ce65" className="canvas-task-parameter-input" /></UiProps></label>
          {!s.instrumental && choices("歌词二次创作", String(Boolean(s.autoLyrics)), [{ value: "true", label: text("workspaceFollowup.m8da97ddda990") }, { value: "false", label: text("workspaceFollowup.m3fd47edce45b") }], v => update({ autoLyrics: v === "true" }))}
        </>}
        {choices("输出格式", s.audioFormat || "auto", ["auto", "mp3", "m4a", "wav"].map(v => ({ value: v, label: v === "auto" ? text("workspaceFollowup.m7eb336e42cb5") : v.toUpperCase() })), v => update({ audioFormat: v === "auto" ? undefined : v as SunoSettings["audioFormat"] }))}
        {s.custom && <div className="canvas-task-parameter-section">{choices("Max 模式", String(Boolean(s.maxMode)), [{ value: "true", label: text("workspaceFollowup.m8da97ddda990") }, { value: "false", label: text("workspaceFollowup.m3fd47edce45b") }], v => update({ maxMode: v === "true" }))}<span className="text-[11px] text-[var(--canvas-controls-text-muted)]"><UiText id="canvas.m3fe40945eaf3" /></span></div>}
        <UiProps ids={{"title":["canvas.m2f6388ab4d78"]}}><button type="button" disabled={disabled} className="flex items-center justify-center gap-1 self-end text-[11px] text-[var(--canvas-controls-text-muted)] hover:text-[var(--canvas-controls-text)] disabled:opacity-50" title="canvas.m2f6388ab4d78" onClick={() => onChange({ custom: s.custom, description: s.description, lyrics: s.lyrics, style: s.style, title: s.title, instrumental: s.instrumental })}><RotateCcw className="h-3 w-3" aria-hidden="true" /><UiText id="canvas.m9ad3f1a7c6b8" /></button></UiProps>
      </div></UiProps>
    </CanvasTaskParameterPopover>
  </div>}</CanvasGeneratorShell></UiProps>;
}
