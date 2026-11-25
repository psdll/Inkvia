"use client";
import { UiProps, UiText } from "@/i18n/ui";

import { useCanvasReadOnly } from "../CanvasReadOnlyContext";
import * as React from "react";
import { ArrowUp, Box, Loader2, RotateCcw, X } from "lucide-react";
import { anglePresets, defaultImageAngle, imageAngleDescription, normalizeImageAngle } from "@/lib/canvas/creative-presets/angle";
import type { ImageAngle } from "@/lib/canvas/creative-presets/types";
import { NodeToolbar, Position } from "@xyflow/react";
import { CanvasAngleGenerationControls } from "./CanvasAngleGenerationControls";
import { getAvailableGptImage25Mode, resolveGptImage25Selection } from "@/lib/gpt-image-25-models";
import { getCanvasImageModelParams, type CanvasImageTaskSettings } from "@/lib/canvas/image-task";
import { resolveCanvasModelId, useCanvasModels } from "../use-canvas-models";
import { useCanvasImageResolution } from "../use-canvas-image-resolution";
import { resolveAngleAspectRatio } from "@/lib/canvas/creative-presets/angle-settings";
import { AngleOrbit } from "./AngleOrbit";
import { CreativeDialog } from "./CreativeDialog";
import styles from "./creative.module.css";

export type AngleGenerationSettings = Pick<CanvasImageTaskSettings, "model" | "aspectRatio" | "resolution" | "quality" | "gptImage25Mode" | "prompt">;

export function CanvasAngleButton({ imageUrl, initialModel, onApply, onOpenChange }: { imageUrl: string; initialModel?: string; onOpenChange?(open: boolean): void; onApply(angle: ImageAngle, settings?: AngleGenerationSettings): void | Promise<void> }) {
  const readOnly = useCanvasReadOnly();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    onOpenChange?.(true);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);
  return <><UiProps ids={{"title":["canvas.m8d855790e87a"],"aria-label":["canvas.m8d855790e87a"]}}><button type="button" className="canvas-material-toolbar-item" title="canvas.m8d855790e87a" aria-label="canvas.m8d855790e87a" disabled={readOnly || !imageUrl || imageUrl.startsWith("blob:")} onClick={() => setOpen(value => !value)}><Box className="h-4 w-4" /><UiText id="canvas.m8d855790e87a" /></button></UiProps>
    {open && <NodeToolbar isVisible position={Position.Bottom} offset={16} className="nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()}>
      <CanvasAngleEditor imageUrl={imageUrl} initialModel={initialModel} inline onClose={() => setOpen(false)} onApply={onApply} />
    </NodeToolbar>}</>;
}

export function CanvasAngleEditor({ imageUrl, initial = defaultImageAngle, initialModel, editing = false, onApply, onClose, anchor, inline = false }: {
  imageUrl: string; initial?: ImageAngle; initialModel?: string; editing?: boolean; anchor?: DOMRect; inline?: boolean;
  onApply(angle: ImageAngle, settings?: AngleGenerationSettings): void | Promise<void>; onClose(): void;
}) {
  const models = useCanvasModels();
  const [selectedModel, setSelectedModel] = React.useState(initialModel || "");
  const selection = resolveGptImage25Selection(selectedModel);
  const model = resolveCanvasModelId(models?.image || [], selection.model);
  const mode = getAvailableGptImage25Mode(model, selection.gptImage25Mode, models?.image.find(item => item.id === model)?.gptImage25Variants);
  const [selectedRatio, setSelectedRatio] = React.useState<string | null>(null);
  const [selectedResolution, setSelectedResolution] = React.useState<string | null>(null);
  const sourceResolution = useCanvasImageResolution(imageUrl, undefined, !editing);
  const baseParams = getCanvasImageModelParams(model);
  const resolution = selectedResolution || baseParams.defaultResolution;
  const ratioParams = getCanvasImageModelParams(model, resolution);
  const sourceRatio = resolveAngleAspectRatio(sourceResolution, ratioParams.aspectRatios);
  const aspectRatio = selectedRatio || sourceRatio;
  const params = getCanvasImageModelParams(model, resolution, aspectRatio);
  const generationSettings = { model, aspectRatio, resolution, quality: params.defaultQuality, gptImage25Mode: mode };
  const [angle, setAngle] = React.useState(() => normalizeImageAngle(initial));
  const [preset, setPreset] = React.useState("自定义");
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [prompt, setPrompt] = React.useState("");
  const presetPrompt = React.useRef("");
  const [pending, setPending] = React.useState(false), [error, setError] = React.useState("");
  const submitting = React.useRef(false);
  const description = imageAngleDescription(angle);
  const patch = (value: Partial<ImageAngle>) => { setPreset("自定义"); setAngle(current => normalizeImageAngle({ ...current, ...value })); };
  return <UiProps ids={{"label":["canvas.m046bdf60fc59"]}}><CreativeDialog compact inline={inline} anchor={anchor} label="canvas.m046bdf60fc59" onClose={() => { if (!pending) onClose(); }}>
    <header className={styles.angleHeader}><strong><UiText id="canvas.m046bdf60fc59" /></strong><UiProps ids={{"aria-label":["canvas.m28eb9155091e"]}}><button type="button" aria-label="canvas.m28eb9155091e" disabled={pending} onClick={onClose}><X size={19} /></button></UiProps></header>
    <UiProps ids={{"aria-label":["canvas.mde7c06fea4bc"]}}><nav className={styles.anglePresets} aria-label="canvas.mde7c06fea4bc">
      {["自定义", ...anglePresets.map(item => item.name)].map(name => <button type="button" key={name} aria-pressed={preset === name} onClick={() => {
        setPreset(name);
        const next = anglePresets.find(item => item.name === name);
        if (!next) return;
        setAngle({ ...next.value });
        // Replace only the intact preset phrase; user-authored additions stay editable.
        const userPrompt = (presetPrompt.current ? prompt.replace(presetPrompt.current, "") : prompt).trim();
        const nextPrompt = [userPrompt, next.prompt].filter(Boolean).join("\n");
        presetPrompt.current = next.prompt || "";
        setPrompt(nextPrompt);
        setShowPrompt(Boolean(nextPrompt));
      }}>{name}</button>)}
    </nav></UiProps>
    <div className={styles.angleBody}>
      <AngleOrbit angle={angle} imageUrl={imageUrl} onChange={next => { setPreset("自定义"); setAngle(next); }} />
      <div className={styles.angleControls}>
        {([['azimuth', '水平环绕', 0, 359, 1], ['elevation', '垂直俯仰', -90, 90, 1], ['zoom', '景别缩放', 0, 10, .1]] as const).map(([key, label, min, max, step]) => <label key={key}>
          <span>{label}</span><input type="range" aria-label={label} min={min} max={max} step={step} value={angle[key]} onChange={event => patch({ [key]: Number(event.target.value) })} style={{ '--range-progress': `${(angle[key] - min) / (max - min) * 100}%` } as React.CSSProperties} />
          <output title={key === "azimuth" ? description.direction : key === "elevation" ? description.elevation : description.distance}>{key === "zoom" ? `${angle.zoom.toFixed(1)} · ${description.distance}` : `${angle[key]}°`}</output>
        </label>)}
        <div className={styles.promptToggle}><span><UiText id="canvas.m4b47dbae97ba" /></span><UiProps ids={{"aria-label":["canvas.m4f128229b86e"]}}><button type="button" role="switch" aria-label="canvas.m4f128229b86e" aria-checked={showPrompt} onClick={() => setShowPrompt(value => !value)}><span /></button></UiProps></div>
        {showPrompt && <UiProps ids={{"aria-label":["canvas.mfcc26843914a"],"placeholder":["canvas.mc91fa0e4556e"]}}><textarea className={styles.anglePrompt} aria-label="canvas.mfcc26843914a" placeholder="canvas.mc91fa0e4556e" value={prompt} onChange={event => setPrompt(event.target.value)} /></UiProps>}
        {angle.lens === "fisheye" && <p className={styles.lens}><UiText id="canvas.md8407682922d" /><button type="button" onClick={() => patch({ lens: "standard" })}><UiText id="canvas.md3e1b5b5fb99" /></button></p>}
      </div>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <footer className={styles.angleFooter}><button type="button" onClick={() => { setAngle({ ...defaultImageAngle }); setPreset("自定义"); setPrompt(""); presetPrompt.current = ""; setShowPrompt(false); setError(""); }}><RotateCcw size={15} /><UiText id="canvas.m432be5625e37" /></button>
      {!editing && <CanvasAngleGenerationControls models={models?.image || []} model={model} mode={mode} aspectRatio={aspectRatio} resolution={resolution} params={params} disabled={pending || !model}
        onModelChange={value => { setSelectedModel(value); setSelectedRatio(null); setSelectedResolution(null); }}
        onRatioChange={setSelectedRatio} onResolutionChange={value => { setSelectedResolution(value); setSelectedRatio(null); }} />}
      <UiProps ids={{"aria-label":["canvas.m9d385e82bdad","canvas.madacd5a72d89"],"title":["canvas.m9d385e82bdad","canvas.me9e2f53d6a33"]}}><button type="button" className="canvas-task-submit-button nodrag" aria-label={editing ? "canvas.m9d385e82bdad" : "canvas.madacd5a72d89"} title={editing ? "canvas.m9d385e82bdad" : "canvas.me9e2f53d6a33"} disabled={pending || (!editing && (!imageUrl || !model || !aspectRatio))} onClick={async () => {
        if (submitting.current) return; submitting.current = true; setPending(true); setError("");
        try { await onApply(angle, { ...generationSettings, prompt: showPrompt ? prompt.trim() : "" }); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : "创建角度任务失败"); } finally { submitting.current = false; setPending(false); }
      }}>{pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3 w-3" strokeWidth={2.25} />}</button></UiProps></footer>
  </CreativeDialog></UiProps>;
}
