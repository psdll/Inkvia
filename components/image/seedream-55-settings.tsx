"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";

import { CircleHelp } from "lucide-react";
import * as React from "react";
import type { Seedream55Settings } from "@/lib/apimart-seedream-55";

const LAYER_LIMITS = [10, 20, 30, 50, 100];

/** 和视频节点“生成音频”同款的问号说明：悬停或聚焦时显示。 */
export function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  const { text } = useUiLocale();
  const id = React.useId();
  return <span className="canvas-video-audio-help">
    <button type="button" aria-label={text("createDynamic.m07ef3d797030", { label: label })} aria-describedby={id} className="nodrag"><CircleHelp aria-hidden="true" /></button>
    <span id={id} role="tooltip" className="canvas-video-audio-tooltip" data-wrap>{children}</span>
  </span>;
}

export function Seedream55SettingsPanel({ value = {}, onChange, disabled, canvas }: { value?: Seedream55Settings; onChange: (value: Seedream55Settings) => void; disabled?: boolean; canvas?: boolean }) {
  const { text } = useUiLocale();
  const section = canvas ? "canvas-task-parameter-section" : "space-y-2";
  const label = `${canvas ? "canvas-task-parameter-label" : "text-[12px] font-semibold text-[var(--app-fg)]/90"} canvas-video-audio-label`;
  const option = (selected: boolean) => canvas
    ? "canvas-task-parameter-option nodrag"
    : `h-9 min-w-0 rounded-lg border px-2 text-[12px] font-semibold transition disabled:opacity-40 ${selected ? "border-[var(--app-fg)] bg-[var(--panel-3)] text-[var(--app-fg)]" : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)]/75 hover:bg-[var(--panel-3)]"}`;
  const layers = Boolean(value.layerDecomposition);
  const maxImages = value.layerMaxImages ?? 30;
  // 保留以前手动填过的非预设值，避免打开面板后被悄悄改掉
  const limits = LAYER_LIMITS.includes(maxImages) ? LAYER_LIMITS : [...LAYER_LIMITS, maxImages].sort((a, b) => a - b);
  const ocr = value.textRecognition ?? false;
  return <UiProps ids={{"aria-label":["image.m71cd73da4825"]}}><div className={canvas ? "canvas-task-parameter-sections" : "space-y-3.5"} aria-label="image.m71cd73da4825">
    <section className={section}>
      <div className={label}>
        <span><UiText id="image.m47a270081ab2" /></span>
        <UiProps ids={{"label":["image.m47a270081ab2"]}}><HelpTip label="image.m47a270081ab2"><UiText id="image.ma206c588da86" /></HelpTip></UiProps>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[{ name: text("createDynamic.mc62a58459251"), layers: false }, { name: text("createDynamic.m294ef06150ca"), layers: true }].map(mode => <button key={mode.name} type="button" className={option(layers === mode.layers)}
          aria-pressed={layers === mode.layers} data-selected={layers === mode.layers} disabled={disabled}
          onClick={() => onChange({ ...value, layerDecomposition: mode.layers })}>{mode.name}</button>)}
      </div>
    </section>
    {layers ? <>
      <section className={section}>
        <div className={label}>
          <span><UiText id="image.m0a248670ab83" /></span>
          <UiProps ids={{"label":["image.m0a248670ab83"]}}><HelpTip label="image.m0a248670ab83"><UiText id="image.m3378ed6ba1dc" /></HelpTip></UiProps>
        </div>
        <UiProps ids={{"aria-label":["image.m0a248670ab83"]}}><div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${limits.length}, minmax(0, 1fr))` }} role="group" aria-label="image.m0a248670ab83">
          {limits.map(limit => <button key={limit} type="button" className={option(maxImages === limit)} aria-pressed={maxImages === limit} data-selected={maxImages === limit}
            disabled={disabled} onClick={() => onChange({ ...value, layerMaxImages: limit })}>{limit}</button>)}
        </div></UiProps>
      </section>
      <section className={section}>
        <div className={label}>
          <span><UiText id="image.m2bfe7a85d4fe" /></span>
          <UiProps ids={{"label":["image.m2bfe7a85d4fe"]}}><HelpTip label="image.m2bfe7a85d4fe"><UiText id="image.m2cba7605ec7a" /></HelpTip></UiProps>
        </div>
        <UiProps ids={{"aria-label":["image.m2bfe7a85d4fe"]}}><div className="canvas-video-audio-options" role="group" aria-label="image.m2bfe7a85d4fe">
          <button type="button" className={option(ocr)} aria-pressed={ocr} data-selected={ocr} disabled={disabled} onClick={() => onChange({ ...value, textRecognition: true })}><UiText id="image.m8da97ddda990" /></button>
          <button type="button" className={option(!ocr)} aria-pressed={!ocr} data-selected={!ocr} disabled={disabled} onClick={() => onChange({ ...value, textRecognition: false })}><UiText id="image.m3fd47edce45b" /></button>
        </div></UiProps>
      </section>
    </> : null}
  </div></UiProps>;
}
