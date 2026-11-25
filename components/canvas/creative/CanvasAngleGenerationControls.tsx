"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";

import { sortAspectRatioOptions } from "@/lib/aspect-ratio-order";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { CanvasAspectRatioIcon } from "../CanvasAspectRatioIcon";
import { CanvasTaskParameterPopover } from "../CanvasTaskParameterPopover";
import type { CanvasImageModel } from "../use-canvas-models";
import type { CanvasImageModelParams } from "@/lib/canvas/image-task";
import { expandGptImage25ModelOptions, getGptImage25ModelLabel, getGptImage25SelectionValue } from "@/lib/gpt-image-25-models";

export function CanvasAngleGenerationControls({ models, model, mode, aspectRatio, resolution, params, disabled, onModelChange, onRatioChange, onResolutionChange }: {
  models: CanvasImageModel[]; model: string; mode?: string; aspectRatio: string; resolution: string;
  params: CanvasImageModelParams; disabled: boolean;
  onModelChange(value: string): void; onRatioChange(value: string): void; onResolutionChange(value: string): void;
}) {
  const { text } = useUiLocale();
  const [open, setOpen] = React.useState<"model" | "params" | null>(null);
  const modelRef = React.useRef<HTMLButtonElement>(null), paramsRef = React.useRef<HTMLButtonElement>(null);
  const selected = models.find(item => item.id === model);
  const modelOptions = expandGptImage25ModelOptions(models.map(item => ({ ...item, value: item.id })));
  const ratioLabel = (value: string) => value === "auto" ? text("workspaceFollowup.m22db4a780f97") : value;
  const resolutionLabel = params.resolutions.find(item => item.value === resolution)?.label || resolution;
  return <div className="relative min-w-0 flex-1" data-canvas-angle-parameter-dock>
    <div className="canvas-task-parameter-bar">
      <UiProps ids={{"aria-label":["canvas.mca9eecb9098f"]}}><button ref={modelRef} type="button" aria-label="canvas.mca9eecb9098f" disabled={disabled} aria-expanded={open === "model"} data-open={open === "model" || undefined} onClick={() => setOpen(value => value === "model" ? null : "model")} className="canvas-task-parameter-trigger">
        <span className="whitespace-nowrap">{getGptImage25ModelLabel(model, selected?.label || "选择图片模型", mode, selected?.gptImage25Variants)}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 opacity-70 transition-transform ${open === "model" ? "rotate-180" : ""}`} />
      </button></UiProps>
      <div className="canvas-task-parameter-divider" />
      <UiProps ids={{"aria-label":["canvas.mb193fd2f7f03"]}}><button ref={paramsRef} type="button" aria-label="canvas.mb193fd2f7f03" disabled={disabled} aria-expanded={open === "params"} data-open={open === "params" || undefined} onClick={() => setOpen(value => value === "params" ? null : "params")} className="canvas-task-parameter-trigger">
        <span className="shrink-0 opacity-80"><CanvasAspectRatioIcon value={aspectRatio} compact /></span>
        <span className="whitespace-nowrap">{ratioLabel(aspectRatio) || <UiText id="canvas.mc2bcb2c395dd" />} · {resolutionLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 opacity-70 transition-transform ${open === "params" ? "rotate-180" : ""}`} />
      </button></UiProps>
    </div>
    <CanvasTaskParameterPopover open={Boolean(open)} anchorRef={open === "params" ? paramsRef : modelRef} onClose={() => setOpen(null)} width={360} maxHeight={open === "model" ? 400 : 560} align="start" side="top" className={`canvas-image-parameter-popover${open === "model" ? " canvas-task-model-popover" : ""}`}>
      {open === "model" ? <div className="space-y-0.5">
        {modelOptions.map(option => <button key={option.value} type="button" data-selected={option.value === getGptImage25SelectionValue(model, mode)} onClick={() => { onModelChange(option.value); setOpen(null); }} className="canvas-task-model-option"><span className="canvas-task-model-label">{option.label}</span></button>)}
      </div> : <div className="canvas-task-parameter-sections">
        <section className="canvas-task-parameter-section">
          <div className="canvas-task-parameter-label"><UiText id="canvas.mb92421822c21" /></div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, params.resolutions.length))}, minmax(0, 1fr))` }}>
            {params.resolutions.map(option => <button key={option.value} type="button" disabled={option.disabled} data-selected={option.value === resolution} onClick={() => onResolutionChange(option.value)} className="canvas-task-parameter-option"><span className="min-w-0 truncate">{option.label}</span></button>)}
          </div>
        </section>
        <section className="canvas-task-parameter-section">
          <div className="canvas-task-parameter-label"><UiText id="canvas.m82a59f3d1c16" /></div>
          <div className="canvas-image-parameter-ratio-grid">
            {sortAspectRatioOptions(params.aspectRatios).filter(option => option.value !== "custom").map(option => <button key={option.value} type="button" disabled={option.disabled} data-selected={option.value === aspectRatio} onClick={() => onRatioChange(option.value)} className="canvas-task-parameter-option canvas-task-aspect-option"><CanvasAspectRatioIcon value={option.value} /><span>{ratioLabel(option.label === "自适应" ? "auto" : option.label)}</span></button>)}
          </div>
        </section>
      </div>}
    </CanvasTaskParameterPopover>
  </div>;
}
